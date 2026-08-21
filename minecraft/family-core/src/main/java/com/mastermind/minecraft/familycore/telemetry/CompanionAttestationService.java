package com.mastermind.minecraft.familycore.telemetry;

import com.mastermind.minecraft.handback.HandbackAttestation;
import com.mastermind.minecraft.handback.HandbackAttestationCodec;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import org.slf4j.Logger;

import java.io.IOException;
import java.io.InputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.nio.file.StandardOpenOption;
import java.util.Arrays;
import java.util.UUID;

public final class CompanionAttestationService implements AutoCloseable {
    private final FamilyCoreRuntimeConfig config;
    private final Logger logger;
    private final UUID serverSessionId = UUID.randomUUID();
    private final byte[] key;
    private long ticks;
    private long sequence;
    private boolean failed;

    public CompanionAttestationService(FamilyCoreRuntimeConfig config, Logger logger) throws IOException {
        this.config = config;
        this.logger = logger;
        if (config.attestationFile().equals(config.keyFile())) {
            throw new IllegalArgumentException("attestation and key files must be distinct");
        }
        Path parent = config.attestationFile().getParent();
        if (parent == null || !Files.isDirectory(parent, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(parent)) {
            throw new IllegalArgumentException("attestation parent must be an existing non-link directory");
        }
        if (!Files.isRegularFile(config.keyFile(), LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(config.keyFile())) {
            throw new IllegalArgumentException("attestation key must be a regular non-link file");
        }
        byte[] loadedKey;
        try (InputStream input = Files.newInputStream(config.keyFile(), LinkOption.NOFOLLOW_LINKS)) {
            loadedKey = input.readNBytes(HandbackAttestationCodec.KEY_BYTES + 1);
        }
        if (loadedKey.length != HandbackAttestationCodec.KEY_BYTES) {
            Arrays.fill(loadedKey, (byte) 0);
            throw new IllegalArgumentException("attestation key must be exactly 32 bytes");
        }
        key = loadedKey;
    }

    public void tick(MinecraftServer server) {
        if (++ticks % config.intervalTicks() != 0) return;
        try {
            writeSnapshot(server);
            if (failed) logger.info("Companion handback attestation recovered");
            failed = false;
        } catch (RuntimeException | IOException error) {
            if (!failed) logger.error("Companion handback attestation failed closed", error);
            failed = true;
            deleteAttestation();
        }
    }

    private void writeSnapshot(MinecraftServer server) throws IOException {
        ServerPlayer player = server.getPlayerList().getPlayer(config.companionUuid());
        boolean present = player != null;
        String dimension = present ? player.level().dimension().identifier().toString() : "minecraft:overworld";
        HandbackAttestation attestation = new HandbackAttestation(
            serverSessionId, config.companionUuid(), ++sequence, System.currentTimeMillis(), dimension,
            present ? player.getX() : 0, present ? player.getY() : 0, present ? player.getZ() : 0,
            present, present && player.isAlive(), present && player.onGround()
        );
        byte[] frame = HandbackAttestationCodec.encode(attestation, key);
        Path temporary = config.attestationFile().resolveSibling(config.attestationFile().getFileName() + ".tmp");
        try {
            Files.deleteIfExists(temporary);
            Files.write(temporary, frame, StandardOpenOption.CREATE_NEW, StandardOpenOption.WRITE);
            if (Files.isSymbolicLink(temporary)) throw new IOException("temporary attestation became a link");
            try {
                Files.move(temporary, config.attestationFile(), StandardCopyOption.ATOMIC_MOVE, StandardCopyOption.REPLACE_EXISTING);
            } catch (AtomicMoveNotSupportedException error) {
                throw new IOException("atomic attestation publication is required", error);
            }
        } finally {
            Arrays.fill(frame, (byte) 0);
            Files.deleteIfExists(temporary);
        }
    }

    private void deleteAttestation() {
        try {
            Files.deleteIfExists(config.attestationFile());
        } catch (IOException error) {
            logger.warn("Could not clear stale companion handback attestation", error);
        }
    }

    @Override
    public void close() {
        deleteAttestation();
        Arrays.fill(key, (byte) 0);
    }
}
