package com.mastermind.minecraft.familyagent.client;

import com.mastermind.minecraft.familyagent.config.BridgeConfig;
import com.mastermind.minecraft.familyagent.navigation.NavigationProviderLoader;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientLifecycleEvents;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.minecraft.client.Minecraft;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

public final class FamilyAgentBridgeClient implements ClientModInitializer {
    private static final Logger LOGGER = LoggerFactory.getLogger("mastermind-family-agent-bridge");

    @Override
    public void onInitializeClient() {
        final BridgeConfig config;
        try {
            config = BridgeConfig.fromEnvironment();
        } catch (IllegalStateException error) {
            LOGGER.warn("Family Agent Bridge is disabled: {}", error.getMessage());
            return;
        }
        var navigation = NavigationProviderLoader.load();
        var runtime = new FamilyBridgeRuntime(Minecraft.getInstance(), config, navigation);
        ClientTickEvents.END_CLIENT_TICK.register(ignored -> runtime.tick());
        ClientLifecycleEvents.CLIENT_STOPPING.register(ignored -> runtime.close());
        runtime.start();
        LOGGER.info("Family Agent Bridge started for Minecraft 26.2; navigation provider {}", navigation.implementationVersion());
    }
}
