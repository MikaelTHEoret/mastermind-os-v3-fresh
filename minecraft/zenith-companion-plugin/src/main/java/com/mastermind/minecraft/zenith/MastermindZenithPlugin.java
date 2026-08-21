package com.mastermind.minecraft.zenith;

import com.mastermind.minecraft.zenith.control.ControlLeaseModule;
import com.zenith.plugin.api.Plugin;
import com.zenith.plugin.api.PluginAPI;
import com.zenith.plugin.api.ZenithProxyPlugin;
import net.kyori.adventure.text.logger.slf4j.ComponentLogger;

@Plugin(
    id = BuildConstants.PLUGIN_ID,
    version = BuildConstants.VERSION,
    description = "Disabled-by-default Mastermind control lease for ZenithProxy",
    url = "https://github.com/MikaelTHEoret/mastermind-os-v3-fresh",
    authors = {"Mastermind"},
    mcVersions = {BuildConstants.MC_VERSION}
)
public final class MastermindZenithPlugin implements ZenithProxyPlugin {
    public static MastermindZenithConfig config;
    public static ComponentLogger log;

    @Override
    public void onLoad(PluginAPI pluginAPI) {
        log = pluginAPI.getLogger();
        config = pluginAPI.registerConfig(BuildConstants.PLUGIN_ID, MastermindZenithConfig.class);
        if (config.enabled
            && config.parentTakeoverEnabled
            && !ControlLeaseModule.isControllerAdmissionHookAvailable()) {
            throw new IllegalStateException("Refusing to load: parent takeover requires the pinned Zenith controller-admission core hook");
        }
        if (config.enabled
            && config.parentTakeoverEnabled
            && !ControlLeaseModule.isNativeTickAdmissionHookAvailable()) {
            throw new IllegalStateException("Refusing to load: parent takeover requires the pinned native bot-tick admission core hook");
        }
        pluginAPI.registerModule(new ControlLeaseModule());
        log.info("Mastermind Zenith companion skeleton loaded; enabled={}", config.enabled);
    }
}
