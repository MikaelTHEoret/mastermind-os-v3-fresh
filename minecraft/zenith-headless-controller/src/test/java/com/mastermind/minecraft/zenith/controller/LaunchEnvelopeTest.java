package com.mastermind.minecraft.zenith.controller;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertThrows;

class LaunchEnvelopeTest {
    private static final String UUID = "996a56dd-fb3c-4f90-9158-1a608652ec77";

    @Test
    void acceptsBoundedLoopbackOfflineProbe() {
        var value = LaunchEnvelope.parse("""
            {"schemaVersion":1,"host":"127.0.0.1","port":25566,"mode":"offline",
             "profile":{"name":"The_AlChemist___","uuid":"%s"},"holdMillis":1000}
            """.formatted(UUID));
        assertEquals("127.0.0.1", value.host);
        assertNull(value.accessToken);
    }

    @Test
    void acceptsOnlineTokenWithoutExposingItThroughValidation() {
        var value = LaunchEnvelope.parse("""
            {"schemaVersion":1,"host":"127.0.0.1","port":25566,"mode":"online",
             "profile":{"name":"The_AlChemist___","uuid":"%s"},
             "accessToken":"0123456789abcdef0123456789abcdef","holdMillis":1000}
            """.formatted(UUID));
        assertEquals(32, value.accessToken.length());
    }

    @Test
    void rejectsNonLoopbackAndTokensInOfflineMode() {
        assertThrows(IllegalArgumentException.class, () -> LaunchEnvelope.parse("""
            {"schemaVersion":1,"host":"0.0.0.0","port":25566,"mode":"offline",
             "profile":{"name":"The_AlChemist___","uuid":"%s"},"holdMillis":1000}
            """.formatted(UUID)));
        assertThrows(IllegalArgumentException.class, () -> LaunchEnvelope.parse("""
            {"schemaVersion":1,"host":"127.0.0.1","port":25566,"mode":"offline",
             "profile":{"name":"The_AlChemist___","uuid":"%s"},
             "accessToken":"must-not-be-here","holdMillis":1000}
            """.formatted(UUID)));
    }

    @Test
    void rejectsUnboundedHoldAndMalformedIdentity() {
        assertThrows(IllegalArgumentException.class, () -> LaunchEnvelope.parse("""
            {"schemaVersion":1,"host":"127.0.0.1","port":25566,"mode":"offline",
             "profile":{"name":"bad name","uuid":"not-a-uuid"},"holdMillis":300001}
            """));
    }
}
