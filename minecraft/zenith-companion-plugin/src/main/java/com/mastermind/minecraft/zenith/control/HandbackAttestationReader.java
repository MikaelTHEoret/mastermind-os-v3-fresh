package com.mastermind.minecraft.zenith.control;

import com.mastermind.minecraft.handback.HandbackAttestation;
import com.mastermind.minecraft.handback.HandbackAttestationCodec;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Arrays;

final class HandbackAttestationReader implements AutoCloseable {
    private final Path attestationFile;
    private final Path killSwitchFile;
    private final byte[] key;

    HandbackAttestationReader(Path attestationFile, Path keyFile, Path killSwitchFile) throws IOException {
        this.attestationFile = requireAbsolute(attestationFile, "attestationFile");
        this.killSwitchFile = requireAbsolute(killSwitchFile, "killSwitchFile");
        Path normalizedKey = requireAbsolute(keyFile, "keyFile");
        if (this.attestationFile.equals(normalizedKey)
            || this.killSwitchFile.equals(normalizedKey)
            || this.killSwitchFile.equals(this.attestationFile)) {
            throw new IllegalArgumentException("handback files must be distinct");
        }
        if (!Files.isRegularFile(normalizedKey, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(normalizedKey)) {
            throw new IllegalArgumentException("handback key must be a regular non-link file");
        }
        byte[] loadedKey;
        try (InputStream input = Files.newInputStream(normalizedKey, LinkOption.NOFOLLOW_LINKS)) {
            loadedKey = input.readNBytes(HandbackAttestationCodec.KEY_BYTES + 1);
        }
        if (loadedKey.length != HandbackAttestationCodec.KEY_BYTES) {
            Arrays.fill(loadedKey, (byte) 0);
            throw new IllegalArgumentException("handback key must be exactly 32 bytes");
        }
        key = loadedKey;
    }

    HandbackAttestation read() throws IOException {
        if (!Files.isRegularFile(attestationFile, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(attestationFile)) {
            throw new IllegalArgumentException("handback attestation must be a regular non-link file");
        }
        long size = Files.size(attestationFile);
        if (size < 1 || size > HandbackAttestationCodec.MAX_FRAME_BYTES) {
            throw new IllegalArgumentException("handback attestation size is invalid");
        }
        byte[] frame;
        try (InputStream input = Files.newInputStream(attestationFile, LinkOption.NOFOLLOW_LINKS)) {
            frame = input.readNBytes(HandbackAttestationCodec.MAX_FRAME_BYTES + 1);
        }
        try {
            return HandbackAttestationCodec.decode(frame, key);
        } finally {
            Arrays.fill(frame, (byte) 0);
        }
    }

    boolean killSwitchClear() {
        return !Files.exists(killSwitchFile, LinkOption.NOFOLLOW_LINKS);
    }

    @Override
    public void close() {
        Arrays.fill(key, (byte) 0);
    }

    private static Path requireAbsolute(Path path, String label) {
        if (path == null || !path.isAbsolute()) throw new IllegalArgumentException(label + " must be absolute");
        return path.normalize();
    }
}
