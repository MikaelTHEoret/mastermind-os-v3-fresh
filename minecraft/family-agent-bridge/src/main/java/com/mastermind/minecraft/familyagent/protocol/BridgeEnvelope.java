package com.mastermind.minecraft.familyagent.protocol;

import com.google.gson.JsonObject;

import java.time.Instant;
import java.util.UUID;

public record BridgeEnvelope(
    UUID messageId,
    UUID sessionId,
    long sequence,
    Instant sentAt,
    String source,
    String type,
    JsonObject payload
) {
    public BridgeEnvelope {
        payload = payload.deepCopy();
    }

    @Override
    public JsonObject payload() {
        return payload.deepCopy();
    }
}

