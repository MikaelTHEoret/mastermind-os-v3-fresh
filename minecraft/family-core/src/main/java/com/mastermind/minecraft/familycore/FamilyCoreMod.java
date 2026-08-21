package com.mastermind.minecraft.familycore;

import com.mastermind.minecraft.familycore.telemetry.CompanionAttestationService;
import com.mastermind.minecraft.familycore.telemetry.FamilyCoreRuntimeConfig;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FamilyCoreMod implements ModInitializer {
    public static final String MOD_ID = "mastermind-family-core";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);

    @Override
    public void onInitialize() {
        try {
            FamilyCoreRuntimeConfig config = FamilyCoreRuntimeConfig.load();
            if (!config.companionTelemetryEnabled()) {
                LOGGER.info("Mastermind Family Core foundation loaded with all runtime features disabled: {}", FamilyCoreFeatures.flags());
                return;
            }
            CompanionAttestationService service = new CompanionAttestationService(config, LOGGER);
            ServerTickEvents.END_SERVER_TICK.register(service::tick);
            ServerLifecycleEvents.SERVER_STOPPING.register(server -> service.close());
            LOGGER.info("Mastermind Family Core loaded with authenticated companion handback telemetry enabled");
        } catch (RuntimeException | java.io.IOException error) {
            throw new IllegalStateException("Refusing to load unsafe Family Core telemetry configuration", error);
        }
    }
}
