package com.mastermind.minecraft.zenith.controller;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class ControllerCommandTest {
    private static final String ID = "01919a62-8e84-7c6b-8eb0-4f79592f3abe";

    @Test
    void acceptsOneBoundedChatAction() {
        var command = ControllerCommand.parse("""
            {"schemaVersion":1,"commandId":"%s","kind":"chat.say","text":"Hello family"}
            """.formatted(ID));
        assertEquals("chat.say", command.kind());
        assertEquals("Hello family", command.text());
    }

    @Test
    void rejectsCommandsUnknownFieldsAndUnsafeText() {
        assertThrows(IllegalArgumentException.class, () -> ControllerCommand.parse("""
            {"schemaVersion":1,"commandId":"%s","kind":"chat.say","text":"/op someone"}
            """.formatted(ID)));
        assertThrows(IllegalArgumentException.class, () -> ControllerCommand.parse("""
            {"schemaVersion":1,"commandId":"%s","kind":"chat.say","text":"hello","extra":true}
            """.formatted(ID)));
        assertThrows(IllegalArgumentException.class, () -> ControllerCommand.parse("""
            {"schemaVersion":1,"commandId":"%s","kind":"chat.say","text":"unsafe\\u202etext"}
            """.formatted(ID)));
    }
}
