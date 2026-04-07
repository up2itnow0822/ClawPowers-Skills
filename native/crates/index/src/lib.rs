//! Vector index adapter for TurboMemory.
//!
//! Exposes a [`VectorIndex`] trait and an [`InMemoryIndex`] implementation
//! that stores compressed vectors via [`TurboCompressor`] and retrieves
//! nearest neighbours using brute-force cosine similarity.

use clawpowers_compression::{CompressedVector, CompressionConfig, TurboCompressor};
use thiserror::Error;
use uuid::Uuid;

/// Errors produced by the index.
#[derive(Debug, Error)]
pub enum IndexError {
    /// The query vector has a different dimensionality than the index.
    #[error("dimension mismatch: expected {expected}, got {got}")]
    DimensionMismatch {
        /// Expected dimensionality.
        expected: usize,
        /// Provided dimensionality.
        got: usize,
    },
    /// The requested number of results is zero.
    #[error("top_k must be > 0")]
    ZeroTopK,
    /// Underlying compression error.
    #[error("compression error: {0}")]
    Compression(#[from] clawpowers_compression::CompressionError),
}

/// A shorthand result type for [`IndexError`].
pub type Result<T> = std::result::Result<T, IndexError>;

/// A single ranked search result.
#[derive(Debug, Clone)]
pub struct SearchResult {
    /// Identifier of the matching vector.
    pub id: Uuid,
    /// Similarity score (cosine similarity, higher is more similar).
    pub score: f32,
}

/// Trait for vector stores used by TurboMemory.
pub trait VectorIndex {
    /// Insert a vector under `id`.
    fn insert(&mut self, id: Uuid, vector: Vec<f32>) -> Result<()>;
    /// Return the `top_k` most similar vectors to `query`, ranked descending by score.
    fn search(&self, query: &[f32], top_k: usize) -> Result<Vec<SearchResult>>;
    /// Remove the vector with `id`. Returns `true` if it was present.
    fn remove(&mut self, id: &Uuid) -> Result<bool>;
    /// Number of vectors currently in the index.
    fn len(&self) -> usize;
    /// Return `true` if the index contains no vectors.
    fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

struct Entry {
    id: Uuid,
    /// Stored for potential future fast-path approximate distance calculations.
    #[allow(dead_code)]
    compressed: CompressedVector,
    /// Original vector used for exact cosine similarity.
    original: Vec<f32>,
}

/// In-memory brute-force vector index backed by TurboQuant compression.
///
/// Suitable for up to ~100 K vectors.
pub struct InMemoryIndex {
    compressor: TurboCompressor,
    entries: Vec<Entry>,
}

impl InMemoryIndex {
    /// Create a new index with the given compression configuration.
    pub fn new(config: CompressionConfig) -> Self {
        let compressor = TurboCompressor::new(config);
        Self {
            compressor,
            entries: Vec::new(),
        }
    }

    /// Create an index with sensible defaults for `dimensions`.
    pub fn with_dimensions(dimensions: usize) -> Self {
        Self::new(CompressionConfig {
            dimensions,
            quantization_bits: 8,
            rotation_seed: 0xDEAD_BEEF_CAFE_1234,
        })
    }
}

impl VectorIndex for InMemoryIndex {
    fn insert(&mut self, id: Uuid, vector: Vec<f32>) -> Result<()> {
        let compressed = self.compressor.compress(&vector)?;
        self.entries.push(Entry {
            id,
            compressed,
            original: vector,
        });
        Ok(())
    }

    fn search(&self, query: &[f32], top_k: usize) -> Result<Vec<SearchResult>> {
        if top_k == 0 {
            return Err(IndexError::ZeroTopK);
        }
        let dim = self.compressor.config.dimensions;
        if query.len() != dim {
            return Err(IndexError::DimensionMismatch {
                expected: dim,
                got: query.len(),
            });
        }
        let mut scored: Vec<(f32, &Entry)> = self
            .entries
            .iter()
            .map(|e| (cosine_similarity(query, &e.original), e))
            .collect();
        scored.sort_by(|a, b| b.0.partial_cmp(&a.0).unwrap_or(std::cmp::Ordering::Equal));
        Ok(scored
            .into_iter()
            .take(top_k)
            .map(|(score, e)| SearchResult { id: e.id, score })
            .collect())
    }

    fn remove(&mut self, id: &Uuid) -> Result<bool> {
        let before = self.entries.len();
        self.entries.retain(|e| &e.id != id);
        Ok(self.entries.len() < before)
    }

    fn len(&self) -> usize {
        self.entries.len()
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let dot: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
    let na: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
    let nb: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();
    if na < f32::EPSILON || nb < f32::EPSILON {
        0.0
    } else {
        dot / (na * nb)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const DIM: usize = 32;

    fn make_index() -> InMemoryIndex {
        InMemoryIndex::with_dimensions(DIM)
    }

    fn unit_vec(hot: usize) -> Vec<f32> {
        let mut v = vec![0.0_f32; DIM];
        v[hot % DIM] = 1.0;
        v
    }

    fn rand_vec(seed: u64) -> Vec<f32> {
        let mut x = seed;
        (0..DIM)
            .map(|_| {
                x = x
                    .wrapping_mul(6_364_136_223_846_793_005)
                    .wrapping_add(1_442_695_040_888_963_407);
                ((x >> 33) as f32 / u32::MAX as f32) * 2.0 - 1.0
            })
            .collect()
    }

    #[test]
    fn test_insert_increases_len() {
        let mut idx = make_index();
        assert_eq!(idx.len(), 0);
        idx.insert(Uuid::new_v4(), rand_vec(1)).expect("insert");
        assert_eq!(idx.len(), 1);
    }

    #[test]
    fn test_empty_index_search_returns_empty() {
        let idx = make_index();
        assert!(idx.search(&rand_vec(2), 5).expect("search").is_empty());
    }

    #[test]
    fn test_is_empty() {
        let mut idx = make_index();
        assert!(idx.is_empty());
        idx.insert(Uuid::new_v4(), rand_vec(3)).expect("insert");
        assert!(!idx.is_empty());
    }

    #[test]
    fn test_search_returns_nearest_neighbour() {
        let mut idx = make_index();
        let query = unit_vec(0);
        let id_match = Uuid::new_v4();
        let id_other = Uuid::new_v4();
        idx.insert(id_match, unit_vec(0)).expect("insert match");
        idx.insert(id_other, unit_vec(1)).expect("insert other");
        let results = idx.search(&query, 1).expect("search");
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, id_match);
    }

    #[test]
    fn test_search_results_ordered_by_score_descending() {
        let mut idx = make_index();
        let query = rand_vec(42);
        for i in 0..5 {
            idx.insert(Uuid::new_v4(), rand_vec(i + 100))
                .expect("insert");
        }
        let results = idx.search(&query, 5).expect("search");
        for w in results.windows(2) {
            assert!(w[0].score >= w[1].score, "{} < {}", w[0].score, w[1].score);
        }
    }

    #[test]
    fn test_search_top_k_limits_results() {
        let mut idx = make_index();
        for i in 0..10 {
            idx.insert(Uuid::new_v4(), rand_vec(i)).expect("insert");
        }
        assert_eq!(idx.search(&rand_vec(99), 3).expect("search").len(), 3);
    }

    #[test]
    fn test_remove_existing_returns_true() {
        let mut idx = make_index();
        let id = Uuid::new_v4();
        idx.insert(id, rand_vec(5)).expect("insert");
        assert!(idx.remove(&id).expect("remove"));
        assert_eq!(idx.len(), 0);
    }

    #[test]
    fn test_remove_nonexistent_returns_false() {
        let mut idx = make_index();
        assert!(!idx.remove(&Uuid::new_v4()).expect("remove"));
    }

    #[test]
    fn test_removed_vector_not_in_results() {
        let mut idx = make_index();
        let query = unit_vec(0);
        let id = Uuid::new_v4();
        idx.insert(id, unit_vec(0)).expect("insert");
        idx.remove(&id).expect("remove");
        assert!(
            !idx.search(&query, 10)
                .expect("search")
                .iter()
                .any(|r| r.id == id)
        );
    }

    #[test]
    fn test_zero_top_k_errors() {
        let mut idx = make_index();
        let _ = idx.insert(Uuid::new_v4(), rand_vec(6));
        assert!(matches!(
            idx.search(&rand_vec(7), 0).expect_err("e"),
            IndexError::ZeroTopK
        ));
    }
}
