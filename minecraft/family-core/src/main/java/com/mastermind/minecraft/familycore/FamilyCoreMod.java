package com.mastermind.minecraft.familycore;

import com.mastermind.minecraft.familycore.telemetry.CompanionAttestationService;
import com.mastermind.minecraft.familycore.telemetry.FamilyCoreRuntimeConfig;
import com.mastermind.minecraft.familycore.bridge.ComputerCommand;
import com.mastermind.minecraft.familycore.bridge.FamilyCoreBridgeRuntime;
import net.fabricmc.api.ModInitializer;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerLifecycleEvents;
import net.fabricmc.fabric.api.event.lifecycle.v1.ServerTickEvents;
import net.fabricmc.fabric.api.message.v1.ServerMessageEvents;
import net.fabricmc.fabric.api.networking.v1.ServerPlayConnectionEvents;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FamilyCoreMod implements ModInitializer {
    public static final String MOD_ID = "mastermind-family-core";
    private static final Logger LOGGER = LoggerFactory.getLogger(MOD_ID);
    private volatile FamilyCoreBridgeRuntime serverBridge;

    @Override
    public void onInitialize() {
        try {
            FamilyCoreRuntimeConfig config = FamilyCoreRuntimeConfig.load();
            if (config.serverBridge().enabled()) {
                ServerLifecycleEvents.SERVER_STARTED.register(server -> {
                    FamilyCoreBridgeRuntime runtime = new FamilyCoreBridgeRuntime(
                        server, config.serverBridge(), config.computerCommandEnabled(), config.identityEventsEnabled(), config.chatCaptureEnabled(), LOGGER
                    );
                    serverBridge = runtime;
                    runtime.start();
                });
                ServerTickEvents.END_SERVER_TICK.register(server -> {
                    FamilyCoreBridgeRuntime runtime = serverBridge;
                    if (runtime != null) runtime.tick();
                });
                ServerLifecycleEvents.SERVER_STOPPING.register(server -> {
                    FamilyCoreBridgeRuntime runtime = serverBridge;
                    serverBridge = null;
                    if (runtime != null) runtime.close();
                });
                if (config.computerCommandEnabled()) ComputerCommand.register(() -> serverBridge);
                if (config.identityEventsEnabled()) {
                    ServerPlayConnectionEvents.JOIN.register((handler, sender, server) -> {
                        FamilyCoreBridgeRuntime runtime = serverBridge;
                        if (runtime != null) runtime.playerJoined(handler.getPlayer());
                    });
                    ServerPlayConnectionEvents.DISCONNECT.register((handler, server) -> {
                        FamilyCoreBridgeRuntime runtime = serverBridge;
                        if (runtime != null) runtime.playerLeft(handler.getPlayer());
                    });
                }
                if (config.chatCaptureEnabled()) {
                    ServerMessageEvents.CHAT_MESSAGE.register((message, sender, params) -> {
                        FamilyCoreBridgeRuntime runtime = serverBridge;
                        if (runtime != null) runtime.chatReceived(sender, message.signedContent());
                    });
                }
            }
            if (config.companionTelemetryEnabled()) {
                CompanionAttestationService service = new CompanionAttestationService(config, LOGGER);
                ServerTickEvents.END_SERVER_TICK.register(service::tick);
                ServerLifecycleEvents.SERVER_STOPPING.register(server -> service.close());
            }
            if (FamilyCoreFeatures.flags(config).values().stream().noneMatch(Boolean::booleanValue)) {
                LOGGER.info("Mastermind Family Core foundation loaded with all runtime features disabled: {}", FamilyCoreFeatures.flags(config));
            } else {
                LOGGER.info("Mastermind Family Core loaded with runtime features: {}", FamilyCoreFeatures.flags(config));
            }
        } catch (RuntimeException | java.io.IOException error) {
            throw new IllegalStateException("Refusing to load unsafe Family Core telemetry configuration", error);
        }
    }
}
