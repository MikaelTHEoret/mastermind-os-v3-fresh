package com.mastermind.minecraft.familyagent.navigation;

import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;

import java.util.Set;

public final class UnavailableNavigationProvider implements NavigationProvider {
    @Override
    public String implementationVersion() {
        return "unavailable";
    }

    @Override
    public Set<String> capabilities() {
        return Set.of();
    }

    @Override
    public JsonObject snapshot() {
        var result = new JsonObject();
        result.addProperty("state", "idle");
        result.add("activeSkill", JsonNull.INSTANCE);
        result.add("goal", JsonNull.INSTANCE);
        return result;
    }

    @Override
    public void start(ActionCommand command, Completion completion) {
        throw new NavigationUnavailableException();
    }

    @Override
    public void cancel(String reason) {
        // There is no navigation process to stop.
    }
}

