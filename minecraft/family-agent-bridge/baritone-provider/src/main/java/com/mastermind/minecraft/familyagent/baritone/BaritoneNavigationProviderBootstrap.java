package com.mastermind.minecraft.familyagent.baritone;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;
import com.mastermind.minecraft.familyagent.navigation.NavigationProvider;
import com.mastermind.minecraft.familyagent.navigation.UnavailableNavigationProvider;
import net.fabricmc.loader.api.FabricLoader;

import java.lang.reflect.InvocationTargetException;
import java.nio.file.Path;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;

/**
 * A Baritone-free ServiceLoader entry point. The typed adapter class is not
 * linked until the exact loader metadata and runtime JAR hash are verified.
 */
public final class BaritoneNavigationProviderBootstrap implements NavigationProvider {
    private static final String ADAPTER_CLASS =
        "com.mastermind.minecraft.familyagent.baritone.VerifiedBaritoneNavigationProvider";

    private final NavigationProvider delegate;

    public BaritoneNavigationProviderBootstrap() {
        delegate = loadVerifiedDelegate();
    }

    @Override
    public String implementationVersion() {
        return delegate.implementationVersion();
    }

    @Override
    public Set<String> capabilities() {
        return delegate.capabilities();
    }

    @Override
    public JsonObject snapshot() {
        return delegate.snapshot();
    }

    @Override
    public void start(ActionCommand command, Completion completion) {
        delegate.start(command, completion);
    }

    @Override
    public void cancel(String reason) {
        delegate.cancel(reason);
    }

    private static NavigationProvider loadVerifiedDelegate() {
        try {
            var loader = FabricLoader.getInstance();
            var versions = new LinkedHashMap<String, String>();
            for (var modId : Set.of("baritone", "minecraft", "fabricloader", "mastermind-family-agent-bridge")) {
                var container = loader.getModContainer(modId).orElse(null);
                if (container == null) {
                    return new UnavailableNavigationProvider();
                }
                versions.put(modId, container.getMetadata().getVersion().getFriendlyString());
            }
            if (!BaritoneRuntimeVerifier.metadataMatches(Map.copyOf(versions))) {
                return new UnavailableNavigationProvider();
            }

            var baritone = loader.getModContainer("baritone").orElseThrow();
            var origins = baritone.getOrigin().getPaths();
            if (origins.size() != 1 || !BaritoneRuntimeVerifier.artifactMatches(singlePath(origins))) {
                return new UnavailableNavigationProvider();
            }

            var type = Class.forName(ADAPTER_CLASS, true, BaritoneNavigationProviderBootstrap.class.getClassLoader());
            return (NavigationProvider) type.getConstructor().newInstance();
        } catch (ClassNotFoundException | NoSuchMethodException | InstantiationException | IllegalAccessException
                 | InvocationTargetException | LinkageError | RuntimeException ignored) {
            return new UnavailableNavigationProvider();
        }
    }

    private static Path singlePath(java.util.List<Path> paths) {
        return paths.getFirst();
    }
}

