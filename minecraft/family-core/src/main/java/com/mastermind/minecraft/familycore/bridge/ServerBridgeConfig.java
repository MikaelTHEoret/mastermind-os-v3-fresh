package com.mastermind.minecraft.familycore.bridge;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.net.URI;
import java.util.Objects;
import java.util.Properties;
import java.util.UUID;
import java.util.regex.Pattern;

public record ServerBridgeConfig(
    boolean enabled,
    URI endpoint,
    UUID sessionId,
    UUID instanceId,
    Path tokenFile,
    int heartbeatTicks
) {
    public static final URI ENDPOINT = URI.create("ws://127.0.0.1:43100/v1/family-core/bridge");
    private static final Pattern TOKEN = Pattern.compile("^[A-Za-z0-9_-]{32,256}$");

    public ServerBridgeConfig {
        if (enabled) {
            Objects.requireNonNull(endpoint, "endpoint");
            Objects.requireNonNull(sessionId, "sessionId");
            Objects.requireNonNull(instanceId, "instanceId");
            Objects.requireNonNull(tokenFile, "tokenFile");
            if (!ENDPOINT.equals(endpoint)) throw new IllegalArgumentException("Family Core endpoint must be the pinned loopback endpoint");
            if (!tokenFile.isAbsolute()) throw new IllegalArgumentException("Family Core token file must be absolute");
            if (heartbeatTicks < 20 || heartbeatTicks > 600) throw new IllegalArgumentException("heartbeatTicks must be between 20 and 600");
        }
    }

    public static ServerBridgeConfig disabled() {
        return new ServerBridgeConfig(false, null, null, null, null, 100);
    }

    public static ServerBridgeConfig fromProperties(Properties properties) {
        Objects.requireNonNull(properties, "properties");
        if (!Boolean.parseBoolean(properties.getProperty("serverBridge.enabled", "false"))) return disabled();
        URI endpoint = URI.create(required(properties, "serverBridge.endpoint"));
        UUID sessionId = UUID.fromString(required(properties, "serverBridge.sessionId"));
        UUID instanceId = UUID.fromString(required(properties, "serverBridge.instanceId"));
        Path tokenFile = Path.of(required(properties, "serverBridge.tokenFile"));
        if (!tokenFile.isAbsolute()) throw new IllegalArgumentException("serverBridge.tokenFile must be absolute");
        tokenFile = tokenFile.normalize();
        int heartbeatTicks = Integer.parseInt(properties.getProperty("serverBridge.heartbeatTicks", "100"));
        return new ServerBridgeConfig(true, endpoint, sessionId, instanceId, tokenFile, heartbeatTicks);
    }

    public String readToken() throws IOException {
        if (!enabled) throw new IllegalStateException("Family Core server bridge is disabled");
        if (!Files.isRegularFile(tokenFile, LinkOption.NOFOLLOW_LINKS) || Files.isSymbolicLink(tokenFile)) {
            throw new IOException("Family Core token must be a regular non-link file");
        }
        long size = Files.size(tokenFile);
        if (size < 32 || size > 258) throw new IOException("Family Core token file is outside its size bound");
        String token = Files.readString(tokenFile, StandardCharsets.US_ASCII).strip();
        if (!TOKEN.matcher(token).matches()) throw new IOException("Family Core token has an invalid format");
        return token;
    }

    public String authorizationHeader() throws IOException {
        return "Bearer " + readToken();
    }

    @Override
    public String toString() {
        return "ServerBridgeConfig[enabled=" + enabled + ", endpoint=" + endpoint
            + ", sessionId=" + sessionId + ", instanceId=" + instanceId
            + ", tokenFile=<redacted>, heartbeatTicks=" + heartbeatTicks + "]";
    }

    private static String required(Properties properties, String key) {
        String value = properties.getProperty(key);
        if (value == null || value.isBlank()) throw new IllegalArgumentException(key + " is required when the server bridge is enabled");
        return value.trim();
    }
}
