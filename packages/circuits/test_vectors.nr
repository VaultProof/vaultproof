// Temporary file to generate Poseidon2 test vectors
// Run: nargo execute --expression "poseidon_hash(1, 2)"

fn poseidon_hash(left: Field, right: Field) -> Field {
    std::hash::poseidon2::Poseidon2::hash([left, right], 2)
}

fn main() {
    // Generate test vectors by printing known hash outputs
    // We'll check these in nargo test
}

#[test]
fn print_test_vectors() {
    // Hash(0, 0)
    let h00 = poseidon_hash(0, 0);
    // Hash(1, 2)
    let h12 = poseidon_hash(1, 2);
    // Hash(12345, 67890)
    let h_big = poseidon_hash(12345, 67890);
    // Hash(42, 0) - used for app_id_hash in tests
    let h42 = poseidon_hash(42, 0);
    // Hash(12345, 67890) then hash(result, 99999) - used in circuit test
    let commitment = poseidon_hash(12345, 67890);
    let nullifier = poseidon_hash(12345, 99999);

    // These won't print but we can assert known values
    // For now just verify they're deterministic
    assert(poseidon_hash(0, 0) == h00);
    assert(poseidon_hash(1, 2) == h12);
    assert(poseidon_hash(12345, 67890) == h_big);
}
