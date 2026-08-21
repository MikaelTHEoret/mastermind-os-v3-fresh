package com.mastermind.minecraft.zenith.controller;

import com.google.gson.Gson;
import com.google.gson.JsonParseException;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

final class LaunchEnvelope {
    static final int MAX_INPUT_BYTES = 16 * 1024;
    private static final Pattern PLAYER_NAME = Pattern.compile("[A-Za-z0-9_]{3,16}");
    private static final Set<String> MODES = Set.of("offline", "online");
    private static final Gson GSON = new Gson();

    int schemaVersion;
    String host;
    int port;
    String mode;
    Profile profile;
    String accessToken;
    int holdMillis;

    static final class Profile {
        String name;
        String uuid;
    }

    static LaunchEnvelope parse(String input) {
        if (input == null || input.isBlank() || input.getBytes(StandardCharsets.UTF_8).length > MAX_INPUT_BYTES) {
            throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE");
        }
        final LaunchEnvelope value;
        try {
            value = GSON.fromJson(input, LaunchEnvelope.class);
        } catch (JsonParseException error) {
            throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE", error);
        }
        if (value == null || value.schemaVersion != 1 || !"127.0.0.1".equals(value.host)
            || value.port < 1024 || value.port > 65535 || !MODES.contains(value.mode)
            || value.profile == null || value.profile.name == null
            || !PLAYER_NAME.matcher(value.profile.name).matches()
            || value.holdMillis < 250 || value.holdMillis > 300_000) {
            throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE");
        }
        final UUID profileId;
        try {
            profileId = UUID.fromString(value.profile.uuid);
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE", error);
        }
        if (profileId.version() < 1 || profileId.version() > 8) {
            throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE");
        }
        if ("online".equals(value.mode)) {
            if (value.accessToken == null || value.accessToken.length() < 16 || value.accessToken.length() > 8192
                || containsControl(value.accessToken)) {
                throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE");
            }
        } else if (value.accessToken != null) {
            throw new IllegalArgumentException("INVALID_LAUNCH_ENVELOPE");
        }
        return value;
    }

    UUID profileId() {
        return UUID.fromString(profile.uuid);
    }

    private static boolean containsControl(String value) {
        return value.codePoints().anyMatch(point -> point < 0x20 || point == 0x7f);
    }
}
