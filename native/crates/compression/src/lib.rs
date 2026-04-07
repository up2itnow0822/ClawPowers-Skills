//! TurboQuant vector compression for TurboMemory.
//!
//! Provides a four-times compression of f32 dense vectors via:
//! 1. Deterministic random orthogonal rotation (decorrelation).
//! 2. Min/max scalar quantization to `u8`.
//! 3. A QJL-inspired residual norm sketch.

use rand::{Rng, SeedableRng, rngs::StdRng};
use serde::{Deserialize, Serialize};
use thiserror::Error;

/// Errors produced by the compression pipeline.
#[derive(Debug, Error)]
pub enum CompressionError {
    /// Input vector has a different length than the configured dimensions.
    #[error("dimension mismatch: expected {expected}, got {got}")]
    DimensionMismatch {
        /// Expected number of dimensions.
        expected: usize,
        /// Actual number of dimensions.
        got: usize,
    },
    /// The compressed vector contains no data.
    #[error("empty compressed vector")]
    EmptyVector,
}

/// A shorthand result type for [`CompressionError`].
pub type Result<T> = std::result::Result<T, CompressionError>;

/// Configuration for the TurboQuant compressor.
#[derive(Debug, Clone)]
pub struct CompressionConfig {
    /// Number of dimensions in the input vectors.
    pub dimensions: usize,
    /// Bits used for scalar quantization (default 8, meaning `u8`).
    pub quantization_bits: u8,
    /// Seed for the deterministic rotation matrix.
    pub rotation_seed: u64,
}

impl Default for CompressionConfig {
    fn default() -> Self {
        Self {
            dimensions: 768,
            quantization_bits: 8,
            rotation_seed: 0xDEAD_BEEF_CAFE_1234,
        }
    }
}

/// The result of compressing a dense f32 vector.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CompressedVector {
    /// Scalar-quantized values in `u8`.
    pub quantized: Vec<u8>,
    /// Minimum f32 value seen in the rotated vector.
    pub min_val: f32,
    /// Maximum f32 value seen in the rotated vector.
    pub max_val: f32,
    /// L2 norm of the quantization error (QJL residual sketch).
    pub residual_norm: f32,
    /// Original dimensionality.
    pub original_dim: usize,
}

impl CompressedVector {
    /// Return the byte size of the quantized payload.
    pub fn byte_size(&self) -> usize {
        self.quantized.len()
    }
}

/// TurboQuant compressor: rotation → quantization → residual sketch.
pub struct TurboCompressor {
    /// Configuration.
    pub config: CompressionConfig,
    rotation_matrix: Vec<f32>,
}

impl TurboCompressor {
    /// Create a new compressor, pre-computing the rotation matrix from the seed.
    pub fn new(config: CompressionConfig) -> Self {
        let rotation_matrix = build_rotation_matrix(config.dimensions, config.rotation_seed);
        Self {
            config,
            rotation_matrix,
        }
    }

    /// Compress `vector` into a [`CompressedVector`].
    pub fn compress(&self, vector: &[f32]) -> Result<CompressedVector> {
        let dim = self.config.dimensions;
        if vector.len() != dim {
            return Err(CompressionError::DimensionMismatch {
                expected: dim,
                got: vector.len(),
            });
        }
        let rotated = mat_vec_mul(&self.rotation_matrix, vector, dim);
        let min_val = rotated.iter().copied().fold(f32::INFINITY, f32::min);
        let max_val = rotated.iter().copied().fold(f32::NEG_INFINITY, f32::max);
        let range = if (max_val - min_val).abs() < f32::EPSILON {
            1.0_f32
        } else {
            max_val - min_val
        };
        let quantized: Vec<u8> = rotated
            .iter()
            .map(|&v| (((v - min_val) / range) * 255.0).round().clamp(0.0, 255.0) as u8)
            .collect();
        let residual_norm = {
            let sum_sq: f32 = rotated
                .iter()
                .zip(quantized.iter())
                .map(|(&orig, &q)| {
                    let reconstructed = (q as f32 / 255.0) * range + min_val;
                    let err = orig - reconstructed;
                    err * err
                })
                .sum();
            sum_sq.sqrt()
        };
        Ok(CompressedVector {
            quantized,
            min_val,
            max_val,
            residual_norm,
            original_dim: dim,
        })
    }

    /// Reconstruct an approximate f32 vector from a [`CompressedVector`].
    pub fn decompress(&self, compressed: &CompressedVector) -> Result<Vec<f32>> {
        if compressed.quantized.is_empty() {
            return Err(CompressionError::EmptyVector);
        }
        let range = compressed.max_val - compressed.min_val;
        let dequantized: Vec<f32> = compressed
            .quantized
            .iter()
            .map(|&q| (q as f32 / 255.0) * range + compressed.min_val)
            .collect();
        Ok(mat_t_vec_mul(
            &self.rotation_matrix,
            &dequantized,
            compressed.original_dim,
        ))
    }

    /// Fast Euclidean distance estimate in the compressed domain.
    pub fn approximate_distance(&self, a: &CompressedVector, b: &CompressedVector) -> Result<f32> {
        if a.quantized.is_empty() || b.quantized.is_empty() {
            return Err(CompressionError::EmptyVector);
        }
        if a.quantized.len() != b.quantized.len() {
            return Err(CompressionError::DimensionMismatch {
                expected: a.quantized.len(),
                got: b.quantized.len(),
            });
        }
        let range_a = a.max_val - a.min_val;
        let range_b = b.max_val - b.min_val;
        let sum_sq: f32 = a
            .quantized
            .iter()
            .zip(b.quantized.iter())
            .map(|(&qa, &qb)| {
                let va = (qa as f32 / 255.0) * range_a + a.min_val;
                let vb = (qb as f32 / 255.0) * range_b + b.min_val;
                let diff = va - vb;
                diff * diff
            })
            .sum();
        Ok(sum_sq.sqrt())
    }
}

fn build_rotation_matrix(dim: usize, seed: u64) -> Vec<f32> {
    let mut rng = StdRng::seed_from_u64(seed);
    let mut basis: Vec<Vec<f32>> = (0..dim)
        .map(|_| (0..dim).map(|_| rng.random::<f32>() * 2.0 - 1.0).collect())
        .collect();
    for i in 0..dim {
        let norm = l2_norm(&basis[i]);
        if norm > f32::EPSILON {
            for x in basis[i].iter_mut() {
                *x /= norm;
            }
        }
        for j in (i + 1)..dim {
            let dot: f32 = basis[i]
                .iter()
                .zip(basis[j].iter())
                .map(|(a, b)| a * b)
                .sum();
            let proj: Vec<f32> = basis[i].iter().map(|&v| v * dot).collect();
            for (x, p) in basis[j].iter_mut().zip(proj.iter()) {
                *x -= p;
            }
        }
    }
    basis.into_iter().flatten().collect()
}

fn mat_vec_mul(matrix: &[f32], vector: &[f32], dim: usize) -> Vec<f32> {
    (0..dim)
        .map(|row| {
            matrix[row * dim..(row + 1) * dim]
                .iter()
                .zip(vector.iter())
                .map(|(m, v)| m * v)
                .sum()
        })
        .collect()
}

fn mat_t_vec_mul(matrix: &[f32], vector: &[f32], dim: usize) -> Vec<f32> {
    let mut result = vec![0.0_f32; dim];
    for row in 0..dim {
        for col in 0..dim {
            result[col] += matrix[row * dim + col] * vector[row];
        }
    }
    result
}

fn l2_norm(v: &[f32]) -> f32 {
    v.iter().map(|x| x * x).sum::<f32>().sqrt()
}

/// Compute the L2 distance between two f32 slices.
pub fn l2_distance(a: &[f32], b: &[f32]) -> f32 {
    a.iter()
        .zip(b.iter())
        .map(|(x, y)| (x - y) * (x - y))
        .sum::<f32>()
        .sqrt()
}

/// Compute cosine similarity between two f32 slices.
pub fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na = l2_norm(a);
    let nb = l2_norm(b);
    if na < f32::EPSILON || nb < f32::EPSILON {
        0.0
    } else {
        dot / (na * nb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIM: usize = 64;

    fn random_vector(dim: usize, seed: u64) -> Vec<f32> {
        let mut rng = StdRng::seed_from_u64(seed);
        (0..dim).map(|_| rng.random::<f32>() * 2.0 - 1.0).collect()
    }

    fn make_compressor(dim: usize) -> TurboCompressor {
        TurboCompressor::new(CompressionConfig {
            dimensions: dim,
            quantization_bits: 8,
            rotation_seed: 42,
        })
    }

    #[test]
    fn test_roundtrip_l2_error_below_threshold() {
        let c = make_compressor(DIM);
        let v = random_vector(DIM, 1);
        let cv = c.compress(&v).expect("compress");
        let r = c.decompress(&cv).expect("decompress");
        let err = l2_distance(&v, &r);
        let norm = l2_norm(&v);
        assert!((if norm > f32::EPSILON { err / norm } else { err }) < 0.05);
    }

    #[test]
    fn test_roundtrip_768_dim() {
        let c = make_compressor(768);
        let v = random_vector(768, 99);
        let cv = c.compress(&v).expect("compress");
        let r = c.decompress(&cv).expect("decompress");
        let err = l2_distance(&v, &r);
        let norm = l2_norm(&v);
        assert!((if norm > f32::EPSILON { err / norm } else { err }) < 0.05);
    }

    #[test]
    fn test_compression_ratio_4x() {
        let c = make_compressor(DIM);
        let cv = c.compress(&random_vector(DIM, 2)).expect("compress");
        assert_eq!(DIM * 4, cv.byte_size() * 4);
    }

    #[test]
    fn test_approximate_distance_preserves_order() {
        let c = make_compressor(DIM);
        let q = random_vector(DIM, 10);
        let mut near = q.clone();
        near[0] += 0.01;
        let far = random_vector(DIM, 20);
        let cq = c.compress(&q).expect("cq");
        let cn = c.compress(&near).expect("cn");
        let cf = c.compress(&far).expect("cf");
        let dn = c.approximate_distance(&cq, &cn).expect("dn");
        let df = c.approximate_distance(&cq, &cf).expect("df");
        assert!(dn < df, "near {dn:.4} should < far {df:.4}");
    }

    #[test]
    fn test_distance_identical_vectors_is_zero() {
        let c = make_compressor(DIM);
        let v = random_vector(DIM, 3);
        let cv = c.compress(&v).expect("cv");
        assert!(c.approximate_distance(&cv, &cv).expect("d") < 0.01);
    }

    #[test]
    fn test_dimension_mismatch_errors() {
        let c = make_compressor(DIM);
        assert!(matches!(
            c.compress(&random_vector(DIM + 1, 4)).expect_err("e"),
            CompressionError::DimensionMismatch { .. }
        ));
    }

    #[test]
    fn test_different_seeds_produce_different_outputs() {
        let c1 = TurboCompressor::new(CompressionConfig {
            dimensions: DIM,
            quantization_bits: 8,
            rotation_seed: 1,
        });
        let c2 = TurboCompressor::new(CompressionConfig {
            dimensions: DIM,
            quantization_bits: 8,
            rotation_seed: 2,
        });
        let v = random_vector(DIM, 5);
        assert_ne!(
            c1.compress(&v).expect("c1").quantized,
            c2.compress(&v).expect("c2").quantized
        );
    }

    #[test]
    fn test_same_seed_is_deterministic() {
        let v = random_vector(DIM, 7);
        assert_eq!(
            make_compressor(DIM).compress(&v).expect("c1").quantized,
            make_compressor(DIM).compress(&v).expect("c2").quantized
        );
    }

    #[test]
    fn test_residual_norm_is_nonnegative() {
        let cv = make_compressor(DIM)
            .compress(&random_vector(DIM, 8))
            .expect("cv");
        assert!(cv.residual_norm >= 0.0);
    }

    #[test]
    fn test_decompress_empty_errors() {
        let c = make_compressor(DIM);
        let empty = CompressedVector {
            quantized: vec![],
            min_val: 0.0,
            max_val: 1.0,
            residual_norm: 0.0,
            original_dim: DIM,
        };
        assert!(matches!(
            c.decompress(&empty).expect_err("e"),
            CompressionError::EmptyVector
        ));
    }

    #[test]
    fn test_all_zero_vector() {
        let c = make_compressor(DIM);
        let zero = vec![0.0_f32; DIM];
        let cv = c.compress(&zero).expect("cv");
        let r = c.decompress(&cv).expect("decompress");
        assert!(l2_distance(&zero, &r) < 1e-5);
    }
}
