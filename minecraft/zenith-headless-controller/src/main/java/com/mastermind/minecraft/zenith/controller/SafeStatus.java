package com.mastermind.minecraft.zenith.controller;

import java.time.Instant;

final class SafeStatus {
    private SafeStatus() {}

    static synchronized void emit(String state, String code) {
        System.out.printf(
            "{\"schemaVersion\":1,\"at\":\"%s\",\"state\":\"%s\",\"code\":\"%s\"}%n",
            Instant.now(), safe(state), safe(code)
        );
        System.out.flush();
    }

    private static String safe(String value) {
        if (value == null || !value.matches("[A-Z0-9_]{2,64}")) return "UNCLASSIFIED";
        return value;
    }
}
