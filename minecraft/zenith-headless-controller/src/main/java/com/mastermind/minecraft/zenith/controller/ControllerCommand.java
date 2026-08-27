package com.mastermind.minecraft.zenith.controller;

import com.google.gson.JsonObject;
import com.google.gson.JsonParser;

import java.nio.charset.StandardCharsets;
import java.util.Set;
import java.util.UUID;

record ControllerCommand(UUID commandId, String kind, String text) {
    static final int MAX_INPUT_BYTES = 2 * 1024;
    static final int MAX_CHAT_CHARACTERS = 220;
    private static final Set<String> EXACT_FIELDS = Set.of("schemaVersion", "commandId", "kind", "text");

    static ControllerCommand parse(String input) {
        if (input == null || input.isBlank() || input.getBytes(StandardCharsets.UTF_8).length > MAX_INPUT_BYTES) {
            throw new IllegalArgumentException("INVALID_CONTROLLER_COMMAND");
        }
        final JsonObject value;
        try {
            value = JsonParser.parseString(input).getAsJsonObject();
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("INVALID_CONTROLLER_COMMAND", error);
        }
        if (!value.keySet().equals(EXACT_FIELDS)
            || !value.get("schemaVersion").isJsonPrimitive() || value.get("schemaVersion").getAsInt() != 1
            || !value.get("commandId").isJsonPrimitive()
            || !value.get("kind").isJsonPrimitive() || !"chat.say".equals(value.get("kind").getAsString())
            || !value.get("text").isJsonPrimitive()) {
            throw new IllegalArgumentException("INVALID_CONTROLLER_COMMAND");
        }
        final UUID commandId;
        try {
            commandId = UUID.fromString(value.get("commandId").getAsString());
        } catch (RuntimeException error) {
            throw new IllegalArgumentException("INVALID_CONTROLLER_COMMAND", error);
        }
        String text = value.get("text").getAsString();
        if (commandId.version() < 1 || commandId.version() > 8
            || text.isBlank() || text.length() > MAX_CHAT_CHARACTERS || text.startsWith("/") || containsUnsafe(text)) {
            throw new IllegalArgumentException("INVALID_CONTROLLER_COMMAND");
        }
        return new ControllerCommand(commandId, "chat.say", text);
    }

    private static boolean containsUnsafe(String value) {
        return value.codePoints().anyMatch(point -> point < 0x20 || point == 0x7f
            || (point >= 0x202a && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069));
    }
}
