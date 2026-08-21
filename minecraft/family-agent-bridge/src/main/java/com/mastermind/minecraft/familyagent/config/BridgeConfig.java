package com.mastermind.minecraft.familyagent.config;

import java.net.URI;
import java.util.Map;
import java.util.Objects;
import java.util.regex.Pattern;

public final class BridgeConfig {
    public static final String TOKEN_ENV = "MASTERMIND_COMPANION_BRIDGE_TOKEN";
    public static final String FAMILY_SERVER_PORT_ENV = "MASTERMIND_FAMILY_SERVER_PORT";
    public static final URI ENDPOINT = URI.create("ws://127.0.0.1:43100/v1/companion/bridge");

    private static final Pattern SAFE_TOKEN = Pattern.compile("^[A-Za-z0-9_-]{32,256}$");
    private final String token;
    private final int familyServerPort;

    private BridgeConfig(String token, int familyServerPort) {
        this.token = token;
        this.familyServerPort = familyServerPort;
    }

    public static BridgeConfig fromEnvironment() {
        return fromEnvironment(System.getenv());
    }

    public static BridgeConfig fromEnvironment(Map<String, String> environment) {
        Objects.requireNonNull(environment, "environment");
        var token = environment.get(TOKEN_ENV);
        if (token == null || !SAFE_TOKEN.matcher(token).matches()) {
            throw new IllegalStateException(TOKEN_ENV + " must contain 32-256 URL-safe characters");
        }
        var rawPort = environment.get(FAMILY_SERVER_PORT_ENV);
        final int familyServerPort;
        try {
            if (rawPort == null || !rawPort.matches("^[1-9][0-9]{0,4}$")) {
                throw new NumberFormatException();
            }
            familyServerPort = Integer.parseInt(rawPort);
            if (familyServerPort > 65_535) {
                throw new NumberFormatException();
            }
        } catch (NumberFormatException error) {
            throw new IllegalStateException(FAMILY_SERVER_PORT_ENV + " must be an integer from 1 through 65535");
        }
        return new BridgeConfig(token, familyServerPort);
    }

    public URI endpoint() {
        return ENDPOINT;
    }

    public String authorizationHeader() {
        return "Bearer " + token;
    }

    public int familyServerPort() {
        return familyServerPort;
    }

    @Override
    public String toString() {
        return "BridgeConfig[endpoint=" + ENDPOINT + ", familyServerPort=" + familyServerPort + ", token=<redacted>]";
    }
}
