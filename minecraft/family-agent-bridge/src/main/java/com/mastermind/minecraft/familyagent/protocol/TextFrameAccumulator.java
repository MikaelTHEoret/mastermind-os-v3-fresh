package com.mastermind.minecraft.familyagent.protocol;

import java.nio.charset.StandardCharsets;
import java.util.Optional;

public final class TextFrameAccumulator {
    private final StringBuilder text = new StringBuilder();

    public Optional<String> append(CharSequence fragment, boolean last) {
        if (fragment == null) {
            throw new ProtocolException("INVALID_MESSAGE", "WebSocket text fragment is missing");
        }
        text.append(fragment);
        if (text.toString().getBytes(StandardCharsets.UTF_8).length > BridgeProtocol.MAX_PAYLOAD_BYTES) {
            text.setLength(0);
            throw new ProtocolException("PAYLOAD_TOO_LARGE", "Family bridge payload exceeds 65536 bytes", 1009);
        }
        if (!last) {
            return Optional.empty();
        }
        var complete = text.toString();
        text.setLength(0);
        return Optional.of(complete);
    }

    public void reset() {
        text.setLength(0);
    }
}
