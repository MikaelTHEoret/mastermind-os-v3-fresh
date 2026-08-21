package com.mastermind.minecraft.familyagent.baritone;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.Map;

final class BaritoneRuntimeVerifier {
    static final String BARITONE_VERSION = "1.18.0";
    static final String MINECRAFT_VERSION = "26.2";
    static final String FABRIC_LOADER_VERSION = "0.19.3";
    static final String BRIDGE_VERSION = "0.1.0";
    static final String BARITONE_SHA256 = "B0E67DCD272453E5DBD7D264CA35E18902D63B87605C3470D95ABE2C970526E9";

    private BaritoneRuntimeVerifier() {
    }

    static boolean metadataMatches(Map<String, String> versions) {
        return BARITONE_VERSION.equals(versions.get("baritone"))
            && MINECRAFT_VERSION.equals(versions.get("minecraft"))
            && FABRIC_LOADER_VERSION.equals(versions.get("fabricloader"))
            && BRIDGE_VERSION.equals(versions.get("mastermind-family-agent-bridge"));
    }

    static boolean artifactMatches(Path artifact) {
        if (artifact == null || !Files.isRegularFile(artifact)) {
            return false;
        }
        try {
            return BARITONE_SHA256.equalsIgnoreCase(sha256(artifact));
        } catch (IOException | NoSuchAlgorithmException ignored) {
            return false;
        }
    }

    static String sha256(Path artifact) throws IOException, NoSuchAlgorithmException {
        var digest = MessageDigest.getInstance("SHA-256");
        try (InputStream input = Files.newInputStream(artifact)) {
            var buffer = new byte[8192];
            for (int count; (count = input.read(buffer)) != -1;) {
                digest.update(buffer, 0, count);
            }
        }
        return HexFormat.of().withUpperCase().formatHex(digest.digest());
    }
}

