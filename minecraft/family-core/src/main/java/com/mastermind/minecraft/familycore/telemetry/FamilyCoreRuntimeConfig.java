package com.mastermind.minecraft.familycore.telemetry;

import com.mastermind.minecraft.familycore.bridge.ServerBridgeConfig;
import net.fabricmc.loader.api.FabricLoader;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.util.Properties;
import java.util.UUID;

public record FamilyCoreRuntimeConfig(
    ServerBridgeConfig serverBridge,
    boolean computerCommandEnabled,
    boolean identityEventsEnabled,
    boolean companionTelemetryEnabled,
    UUID companionUuid,
    Path attestationFile,
    Path keyFile,
    int intervalTicks
) {
    private static final String FILE_NAME = "mastermind-family-core.properties";

    public static FamilyCoreRuntimeConfig load() throws IOException {
        Path configFile = FabricLoader.getInstance().getConfigDir().resolve(FILE_NAME).toAbsolutePath().normalize();
        if (!Files.exists(configFile, LinkOption.NOFOLLOW_LINKS)) return disabled();
        if (!Files.isRegularFile(configFile, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(configFile)) {
            throw new IllegalArgumentException("Family Core runtime config must be a regular non-link file");
        }
        Properties properties = new Properties();
        try (Reader reader = Files.newBufferedReader(configFile, StandardCharsets.UTF_8)) {
            properties.load(reader);
        }
        return fromProperties(properties);
    }

    public static FamilyCoreRuntimeConfig fromProperties(Properties properties) {
        ServerBridgeConfig serverBridge = ServerBridgeConfig.fromProperties(properties);
        boolean computerCommandEnabled = Boolean.parseBoolean(properties.getProperty("computerCommand.enabled", "false"));
        if (computerCommandEnabled && !serverBridge.enabled()) {
            throw new IllegalArgumentException("computerCommand requires serverBridge.enabled=true");
        }
        boolean identityEventsEnabled = Boolean.parseBoolean(properties.getProperty("identityEvents.enabled", "false"));
        if (identityEventsEnabled && !serverBridge.enabled()) {
            throw new IllegalArgumentException("identityEvents requires serverBridge.enabled=true");
        }
        boolean enabled = Boolean.parseBoolean(properties.getProperty("companionTelemetry.enabled", "false"));
        if (!enabled) return new FamilyCoreRuntimeConfig(serverBridge, computerCommandEnabled, identityEventsEnabled, false, null, null, null, 5);
        UUID companionUuid = UUID.fromString(required(properties, "companionTelemetry.companionUuid"));
        Path attestationFile = absolutePath(required(properties, "companionTelemetry.attestationFile"), "attestationFile");
        Path keyFile = absolutePath(required(properties, "companionTelemetry.keyFile"), "keyFile");
        int intervalTicks = Integer.parseInt(properties.getProperty("companionTelemetry.intervalTicks", "5"));
        if (intervalTicks < 1 || intervalTicks > 100) throw new IllegalArgumentException("intervalTicks must be between 1 and 100");
        return new FamilyCoreRuntimeConfig(serverBridge, computerCommandEnabled, identityEventsEnabled, true, companionUuid, attestationFile, keyFile, intervalTicks);
    }

    public static FamilyCoreRuntimeConfig disabled() {
        return new FamilyCoreRuntimeConfig(ServerBridgeConfig.disabled(), false, false, false, null, null, null, 5);
    }

    private static String required(Properties properties, String key) {
        String value = properties.getProperty(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " is required when telemetry is enabled");
        return value.trim();
    }

    private static Path absolutePath(String value, String label) {
        Path path = Path.of(value);
        if (!path.isAbsolute()) throw new IllegalArgumentException(label + " must be absolute");
        return path.normalize();
    }
}
