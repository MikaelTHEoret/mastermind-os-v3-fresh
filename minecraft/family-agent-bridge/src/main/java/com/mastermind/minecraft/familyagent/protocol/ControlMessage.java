package com.mastermind.minecraft.familyagent.protocol;

import com.mastermind.minecraft.familyagent.action.ActionCommand;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

public sealed interface ControlMessage {
    BridgeEnvelope envelope();

    record Hello(
        BridgeEnvelope envelope,
        int helloTimeoutMs,
        int heartbeatIntervalMs,
        int heartbeatTimeoutMs
    ) implements ControlMessage {
    }

    record Ready(
        BridgeEnvelope envelope,
        int heartbeatIntervalMs,
        int snapshotIntervalMs,
        List<String> acceptedCapabilities
    ) implements ControlMessage {
        public Ready {
            acceptedCapabilities = List.copyOf(acceptedCapabilities);
        }
    }

    record Execute(BridgeEnvelope envelope, ActionCommand action) implements ControlMessage {
    }

    record Cancel(BridgeEnvelope envelope, UUID actionId, String reason) implements ControlMessage {
    }

    record Shutdown(BridgeEnvelope envelope, UUID shutdownId, Instant deadlineAt) implements ControlMessage {
    }
}

