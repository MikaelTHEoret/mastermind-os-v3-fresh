package com.mastermind.minecraft.familycore;

import com.mastermind.minecraft.familycore.telemetry.FamilyCoreRuntimeConfig;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class FamilyCoreFeatures {
    private static final Map<String, Boolean> FLAGS;

    static {
        FLAGS = flags(FamilyCoreRuntimeConfig.disabled());
    }

    public static Map<String, Boolean> flags(FamilyCoreRuntimeConfig config) {
        Map<String, Boolean> flags = new LinkedHashMap<>();
        flags.put("serverBridge", config.serverBridge().enabled());
        flags.put("computerCommand", config.computerCommandEnabled());
        flags.put("chatCapture", false);
        flags.put("identityEvents", false);
        flags.put("adminExecution", false);
        flags.put("serverShutdown", false);
        flags.put("companionTelemetry", false);
        flags.put("companionEvents", false);
        return Collections.unmodifiableMap(flags);
    }

    private FamilyCoreFeatures() {
    }

    public static Map<String, Boolean> flags() {
        return FLAGS;
    }

    public static boolean enabled(String feature) {
        return Boolean.TRUE.equals(FLAGS.get(feature));
    }
}
