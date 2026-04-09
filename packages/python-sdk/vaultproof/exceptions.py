class VaultProofError(Exception):
    """Raised for all VaultProof API and validation errors."""
    def __init__(self, message: str, status: int = 0) -> None:
        super().__init__(message)
        self.status = status
