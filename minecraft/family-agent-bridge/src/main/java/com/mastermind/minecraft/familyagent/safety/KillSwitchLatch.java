package com.mastermind.minecraft.familyagent.safety;

import java.util.concurrent.atomic.AtomicBoolean;

public final class KillSwitchLatch {
    private final AtomicBoolean engaged = new AtomicBoolean();

    public boolean engage() {
        return engaged.compareAndSet(false, true);
    }

    public boolean isEngaged() {
        return engaged.get();
    }
}
