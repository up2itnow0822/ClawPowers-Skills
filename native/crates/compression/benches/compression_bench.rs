use clawpowers_compression::{CompressionConfig, TurboCompressor};
use criterion::{BenchmarkId, Criterion, criterion_group, criterion_main};

fn make_vector(dim: usize, seed: u64) -> Vec<f32> {
    use std::collections::hash_map::DefaultHasher;
    use std::hash::{Hash, Hasher};
    (0..dim)
        .map(|i| {
            let mut h = DefaultHasher::new();
            (seed ^ i as u64).hash(&mut h);
            let v = h.finish() as f32 / u64::MAX as f32;
            v * 2.0 - 1.0
        })
        .collect()
}

fn bench_compress_decompress(c: &mut Criterion) {
    let dim = 768;
    let compressor = TurboCompressor::new(CompressionConfig {
        dimensions: dim,
        quantization_bits: 8,
        rotation_seed: 0xDEAD_BEEF,
    });
    let vector = make_vector(dim, 1);

    let mut group = c.benchmark_group("turbo_compression");

    group.bench_function(BenchmarkId::new("compress", dim), |b| {
        b.iter(|| compressor.compress(&vector).expect("compress"));
    });

    let compressed = compressor.compress(&vector).expect("pre-compress");

    group.bench_function(BenchmarkId::new("decompress", dim), |b| {
        b.iter(|| compressor.decompress(&compressed).expect("decompress"));
    });

    group.finish();
}

criterion_group!(benches, bench_compress_decompress);
criterion_main!(benches);
