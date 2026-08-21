package com.mastermind.minecraft.familyagent.baritone;

import org.junit.jupiter.api.Test;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Map;
import java.util.zip.ZipFile;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class BaritoneRuntimeVerifierTest {
    @Test
    void acceptsOnlyTheExactCompatibilityTuple() {
        var exact = Map.of(
            "baritone", "1.18.0",
            "minecraft", "26.2",
            "fabricloader", "0.19.3",
            "mastermind-family-agent-bridge", "0.1.0"
        );
        assertTrue(BaritoneRuntimeVerifier.metadataMatches(exact));
        assertFalse(BaritoneRuntimeVerifier.metadataMatches(Map.of(
            "baritone", "1.18.0",
            "minecraft", "1.21.4",
            "fabricloader", "0.19.3",
            "mastermind-family-agent-bridge", "0.1.0"
        )));
    }

    @Test
    void verifiesThePinnedRuntimeAndRequiredTypedApiClasses() throws Exception {
        var artifact = Path.of(System.getProperty("mastermind.baritone.artifact"));
        assertTrue(Files.isRegularFile(artifact));
        assertEquals(BaritoneRuntimeVerifier.BARITONE_SHA256, BaritoneRuntimeVerifier.sha256(artifact));
        assertTrue(BaritoneRuntimeVerifier.artifactMatches(artifact));

        try (var archive = new ZipFile(artifact.toFile())) {
            assertNotNull(archive.getEntry("baritone/BaritoneProvider.class"));
            assertNotNull(archive.getEntry("baritone/api/BaritoneAPI.class"));
            assertNotNull(archive.getEntry("baritone/api/process/ICustomGoalProcess.class"));
            assertNotNull(archive.getEntry("baritone/api/process/IFollowProcess.class"));
            assertNotNull(archive.getEntry("baritone/api/process/IMineProcess.class"));
            assertNotNull(archive.getEntry("mixins.baritone.json"));
        }
    }

    @Test
    void rejectsAnyOtherFileEvenWhenItExists() throws Exception {
        var modified = Files.createTempFile("baritone-modified", ".jar");
        Files.writeString(modified, "not the verified runtime");
        try {
            assertFalse(BaritoneRuntimeVerifier.artifactMatches(modified));
        } finally {
            Files.deleteIfExists(modified);
        }
    }
}

