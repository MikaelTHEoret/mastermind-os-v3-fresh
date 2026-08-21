package com.mastermind.minecraft.familyclientbootstrap;

final class GameArguments {
    private GameArguments() {}

    static String[] create(LaunchProfile profile, CredentialPayload credentials) {
        return new String[] {
            "--username", credentials.usernameArgument(),
            "--version", profile.version(),
            "--gameDir", profile.gameDirectory().toString(),
            "--assetsDir", profile.assetsDirectory().toString(),
            "--assetIndex", profile.assetIndex(),
            "--uuid", credentials.uuidArgument(),
            "--accessToken", credentials.accessTokenArgument(),
            "--clientId", credentials.clientIdArgument(),
            "--xuid", credentials.xuidArgument(),
            "--versionType", profile.versionType(),
            "--quickPlayMultiplayer", LaunchProfile.SERVER_HOST + ":" + profile.serverPort(),
        };
    }
}
