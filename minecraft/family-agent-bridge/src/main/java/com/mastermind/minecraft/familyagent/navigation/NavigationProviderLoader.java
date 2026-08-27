package com.mastermind.minecraft.familyagent.navigation;

import java.util.ServiceLoader;

public final class NavigationProviderLoader {
    private NavigationProviderLoader() {
    }

    public static NavigationProvider load() {
        return ServiceLoader.load(NavigationProvider.class)
            .findFirst()
            .orElseGet(UnavailableNavigationProvider::new);
    }
}

