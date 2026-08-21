package com.mastermind.minecraft.familyagent.action;

import com.google.gson.JsonObject;
import org.junit.jupiter.api.Test;

import java.time.Instant;
import java.util.ArrayList;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class ActionRegistryTest {
    @Test
    void rejectsBusyMotionLaneAndCancelsExactlyOnce() {
        var registry = new ActionRegistry();
        var reasons = new ArrayList<String>();
        var first = command("11111111-1111-4111-8111-111111111111", "direct.moveFor");
        var second = command("22222222-2222-4222-8222-222222222222", "direct.lookAt");

        assertEquals(ActionRegistry.BeginResult.STARTED, registry.begin(first, reasons::add));
        assertEquals(ActionRegistry.BeginResult.BUSY, registry.begin(second, reasons::add));
        assertEquals(java.util.List.of(), reasons);
        assertEquals(first.actionId(), registry.active().orElseThrow().actionId());

        assertTrue(registry.cancelAll("connection-lost"));
        assertFalse(registry.cancelAll("connection-lost"));
        assertEquals(java.util.List.of("connection-lost"), reasons);
    }

    @Test
    void deduplicatesActiveAndTerminalActionIds() {
        var registry = new ActionRegistry();
        var calls = new AtomicInteger();
        var command = command("33333333-3333-4333-8333-333333333333", "direct.jump");

        assertEquals(ActionRegistry.BeginResult.STARTED, registry.begin(command, ignored -> calls.incrementAndGet()));
        assertEquals(ActionRegistry.BeginResult.ALREADY_ACTIVE, registry.begin(command, ignored -> calls.incrementAndGet()));
        assertTrue(registry.complete(command.actionId(), "succeeded"));
        assertEquals(ActionRegistry.BeginResult.ALREADY_TERMINAL, registry.begin(command, ignored -> calls.incrementAndGet()));
        assertEquals("succeeded", registry.terminal(command.actionId()).orElseThrow().status());
        assertEquals(0, calls.get());
    }

    @Test
    void terminalCacheIsBounded() {
        var registry = new ActionRegistry();
        for (var index = 0; index < 140; index++) {
            var command = new ActionCommand(UUID.randomUUID(), Instant.MAX, "direct.jump", new JsonObject());
            registry.begin(command, ignored -> { });
            registry.complete(command.actionId(), "succeeded");
        }
        assertEquals(128, registry.terminalCount());
    }

    private ActionCommand command(String id, String kind) {
        return new ActionCommand(UUID.fromString(id), Instant.MAX, kind, new JsonObject());
    }
}
