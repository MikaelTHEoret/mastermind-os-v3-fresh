package com.mastermind.minecraft.familycore;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

public final class FamilyCoreFeatures {
    private static final Map<String, Boolean> FLAGS;

    static {
        Map<String, Boolean> flags = new LinkedHashMap<>();
        flags.put("serverBridge", false);
        flags.put("computerCommand", false);
        flags.put("chatCapture", false);
        flags.put("identityEvents", false);
        flags.put("adminExecution", false);
        flags.put("serverShutdown", false);
        flags.put("companionTelemetry", false);
        flags.put("companionEvents", false);
        FLAGS = Collections.unmodifiableMap(flags);
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
