package com.mastermind.minecraft.familycore.protocol;

import java.util.Set;
import java.util.UUID;
import java.util.regex.Pattern;

public final class FamilyCoreProtocol {
    public static final String NAME = "mastermind.family-core";
    public static final int VERSION = 1;
    public static final String SUBPROTOCOL = "mastermind.family-core.v1";
    public static final int MAX_PAYLOAD_BYTES = 64 * 1024;
    public static final int MAX_CHAT_CHARACTERS = 512;

    public static final Set<String> SERVER_MESSAGE_TYPES = Set.of(
        "server.hello", "server.heartbeat", "chat.received", "computer.requested",
        "player.joined", "player.left", "server.event", "admin.result",
        "companion.telemetry", "companion.event"
    );

    public static final Set<String> CONTROL_MESSAGE_TYPES = Set.of(
        "computer.broadcast", "computer.private", "computer.requestStatus",
        "admin.execute", "server.shutdown", "companion.requestSnapshot"
    );

    private static final Pattern UNSAFE_TEXT = Pattern.compile("[\\x00-\\x08\\x0B\\x0C\\x0E-\\x1F\\x7F\\u202A-\\u202E\\u2066-\\u2069]");

    private FamilyCoreProtocol() {
    }

    public static UUID requireUuid(String value, String label) {
        try {
            return UUID.fromString(value);
        } catch (RuntimeException error) {
            throw new IllegalArgumentException(label + " must be a UUID", error);
        }
    }

    public static String requireChatText(String value) {
        if (value == null || value.isBlank() || value.length() > MAX_CHAT_CHARACTERS || UNSAFE_TEXT.matcher(value).find()) {
            throw new IllegalArgumentException("Chat text is outside its allowed bounds");
        }
        return value;
    }

    public static long requireSequence(long value) {
        if (value < 1) {
            throw new IllegalArgumentException("Sequence must be positive");
        }
        return value;
    }
}
