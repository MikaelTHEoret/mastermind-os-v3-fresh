package com.mastermind.minecraft.familycore.bridge;

import org.junit.jupiter.api.Test;

import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class FamilyCoreHeartbeatLoopTest {
    @Test
    void heartbeatRunsOnWallClockWithoutMinecraftTicksAndStopsCleanly() throws Exception {
        CountDownLatch beat = new CountDownLatch(1);
        AtomicInteger calls = new AtomicInteger();
        FamilyCoreHeartbeatLoop loop = new FamilyCoreHeartbeatLoop(20, () -> {
            calls.incrementAndGet();
            beat.countDown();
        });
        try {
            loop.start();
            assertTrue(beat.await(1_750, TimeUnit.MILLISECONDS));
        } finally {
            loop.close();
        }
        int afterClose = calls.get();
        Thread.sleep(1_200);
        assertEquals(afterClose, calls.get());
    }

    @Test
    void invalidIntervalsAndMissingActionFailClosed() {
        assertThrows(IllegalArgumentException.class, () -> new FamilyCoreHeartbeatLoop(19, () -> {}));
        assertThrows(IllegalArgumentException.class, () -> new FamilyCoreHeartbeatLoop(601, () -> {}));
        assertThrows(IllegalArgumentException.class, () -> new FamilyCoreHeartbeatLoop(100, null));
    }
}
