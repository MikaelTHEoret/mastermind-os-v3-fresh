package com.mastermind.minecraft.familyagent.navigation;

import com.google.gson.JsonObject;
import com.mastermind.minecraft.familyagent.action.ActionCommand;

import java.util.Set;

public interface NavigationProvider {
    interface Completion {
        void succeeded(String resultCode);

        void failed(String errorCode, String message);
    }

    String implementationVersion();

    Set<String> capabilities();

    JsonObject snapshot();

    void start(ActionCommand command, Completion completion);

    void cancel(String reason);
}

