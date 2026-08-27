package com.mastermind.minecraft.familyagent.safety;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class KillSwitchLatchTest {
    @Test
    void latchesOnceAndHasNoRemoteResetPath() {
        var latch = new KillSwitchLatch();
        assertFalse(latch.isEngaged());
        assertTrue(latch.engage());
        assertTrue(latch.isEngaged());
        assertFalse(latch.engage());
        assertTrue(latch.isEngaged());
    }
}
