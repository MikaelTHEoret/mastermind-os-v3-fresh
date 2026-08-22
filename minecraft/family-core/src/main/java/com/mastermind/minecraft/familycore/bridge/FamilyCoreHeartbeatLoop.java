package com.mastermind.minecraft.familycore.bridge;

import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * Runs transport liveness independently from Minecraft game ticks, which may
 * pause indefinitely while an empty server remains healthy and reachable.
 */
public final class FamilyCoreHeartbeatLoop implements AutoCloseable {
    private static final long MINECRAFT_TICK_MILLIS = 50L;

    private final ScheduledExecutorService scheduler;
    private final Runnable heartbeat;
    private final long intervalMillis;
    private final AtomicBoolean started = new AtomicBoolean();
    private final AtomicBoolean closed = new AtomicBoolean();

    public FamilyCoreHeartbeatLoop(int intervalTicks, Runnable heartbeat) {
        if (intervalTicks < 20 || intervalTicks > 600) {
            throw new IllegalArgumentException("intervalTicks must be between 20 and 600");
        }
        if (heartbeat == null) throw new IllegalArgumentException("heartbeat is required");
        this.intervalMillis = Math.multiplyExact(intervalTicks, MINECRAFT_TICK_MILLIS);
        this.heartbeat = heartbeat;
        this.scheduler = Executors.newSingleThreadScheduledExecutor(runnable -> {
            Thread thread = new Thread(runnable, "mastermind-family-core-heartbeat");
            thread.setDaemon(true);
            return thread;
        });
    }

    public void start() {
        if (closed.get() || !started.compareAndSet(false, true)) return;
        scheduler.scheduleAtFixedRate(this::runSafely, intervalMillis, intervalMillis, TimeUnit.MILLISECONDS);
    }

    private void runSafely() {
        if (closed.get()) return;
        try {
            heartbeat.run();
        } catch (RuntimeException ignored) {
            // The WebSocket transport owns reconnect and error reporting. A
            // single failed send must not permanently cancel future beats.
        }
    }

    @Override
    public void close() {
        if (!closed.compareAndSet(false, true)) return;
        scheduler.shutdownNow();
    }
}
