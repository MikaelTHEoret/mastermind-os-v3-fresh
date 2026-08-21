package com.mastermind.minecraft.zenith;

import java.util.ArrayList;
import java.util.List;

public final class MastermindZenithConfig {
    public boolean enabled = false;
    public boolean nativeFallbackEnabled = false;
    public boolean enhancedControllerEnabled = false;
    public boolean parentTakeoverEnabled = false;
    public String expectedBindAddress = "127.0.0.1";
    public int handbackStableMilliseconds = 2_000;
    public String serviceControllerUuid = "";
    public List<String> parentControllerUuids = new ArrayList<>();
}
