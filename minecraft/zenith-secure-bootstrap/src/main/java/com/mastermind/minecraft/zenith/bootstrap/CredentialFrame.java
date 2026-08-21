package com.mastermind.minecraft.zenith.bootstrap;

import java.util.Arrays;

record CredentialFrame(char[] username, char[] uuid, char[] accessToken, char[] xuid, char[] clientId)
    implements AutoCloseable {
    @Override
    public void close() {
        for (char[] field : new char[][] { username, uuid, accessToken, xuid, clientId }) {
            if (field != null) Arrays.fill(field, '\0');
        }
    }
}
