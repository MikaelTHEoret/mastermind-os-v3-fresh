package com.mastermind.minecraft.familycore;

import net.fabricmc.api.ModInitializer;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FamilyCoreMod implements ModInitializer {
    public static final String MOD_ID = "mastermind-family-core";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        // Foundation only: do not register chat listeners, commands, network clients,
        // or privileged executors until their individual staging gates pass.
        LOGGER.info("Mastermind Family Core foundation loaded with all runtime features disabled: {}", FamilyCoreFeatures.flags());
    }
}
