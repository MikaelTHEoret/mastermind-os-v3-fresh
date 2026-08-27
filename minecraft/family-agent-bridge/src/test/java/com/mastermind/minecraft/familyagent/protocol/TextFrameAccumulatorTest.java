package com.mastermind.minecraft.familyagent.protocol;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class TextFrameAccumulatorTest {
    @Test
    void joinsFragmentsAndCountsUtf8Bytes() {
        var accumulator = new TextFrameAccumulator();
        assertTrue(accumulator.append("{\"word\":\"", false).isEmpty());
        assertEquals("{\"word\":\"é\"}", accumulator.append("é\"}", true).orElseThrow());

        var oversized = "é".repeat((BridgeProtocol.MAX_PAYLOAD_BYTES / 2) + 1);
        assertThrows(ProtocolException.class, () -> accumulator.append(oversized, true));
    }
}
