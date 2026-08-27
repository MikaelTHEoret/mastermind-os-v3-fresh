package com.mastermind.minecraft.familyagent.navigation;

public final class NavigationUnavailableException extends RuntimeException {
    public NavigationUnavailableException() {
        super("No verified Minecraft 26.2 navigation provider is installed");
    }
}

