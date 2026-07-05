import secrets

ID_ALPHABET = "23456789abcdefghijkmnpqrstuvwxyz"
ID_LENGTH = 10


def new_id(prefix: str) -> str:
    suffix = "".join(secrets.choice(ID_ALPHABET) for _ in range(ID_LENGTH))
    return f"{prefix}_{suffix}"
