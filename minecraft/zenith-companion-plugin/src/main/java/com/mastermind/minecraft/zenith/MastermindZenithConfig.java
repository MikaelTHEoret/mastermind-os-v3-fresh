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
    public boolean pairedHandbackEnabled = false;
    public int handbackPollMilliseconds = 250;
    public int handbackMaximumAgeMilliseconds = 1_500;
    public double handbackMaximumPositionDelta = 1.5;
    public String handbackAttestationFile = "";
    public String handbackKeyFile = "";
    public String handbackKillSwitchFile = "";
    public String serviceControllerUuid = "";
    public List<String> parentControllerUuids = new ArrayList<>();
}
