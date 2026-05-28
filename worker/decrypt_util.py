"""AES-256 복호화 — Next.js crypto.ts와 동일 로직"""

import os
import json
from Crypto.Cipher import AES
from Crypto.Util.Padding import unpad
import binascii


def get_key() -> bytes:
    raw = os.getenv("ENCRYPTION_KEY", "mezz-watch-encryption-key-32ch!!")
    return raw[:32].encode("utf-8").ljust(32, b"!")[:32]


def decrypt_credentials(ciphertext: str) -> dict:
    """암호화된 credentials JSON 복호화"""
    iv_hex, enc_hex = ciphertext.split(":")
    iv = binascii.unhexlify(iv_hex)
    encrypted = binascii.unhexlify(enc_hex)

    cipher = AES.new(get_key(), AES.MODE_CBC, iv)
    decrypted = unpad(cipher.decrypt(encrypted), AES.block_size)

    return json.loads(decrypted.decode("utf-8"))
