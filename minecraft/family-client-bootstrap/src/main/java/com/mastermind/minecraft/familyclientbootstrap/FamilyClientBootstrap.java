package com.mastermind.minecraft.familyclientbootstrap;

import java.io.InputStream;
import java.io.PrintStream;
import java.util.Arrays;
import java.util.Map;

/** Stable, dependency-free credential boundary in front of Fabric KnotClient. */
public final class FamilyClientBootstrap {
    static final String FABRIC_MAIN_CLASS = "net.fabricmc.loader.impl.launch.knot.KnotClient";

    private FamilyClientBootstrap() {}

    public static void main(String[] arguments) {
        ClassLoader loader = Thread.currentThread().getContextClassLoader();
        int status = run(arguments, System.in, System.getenv(), new ReflectiveMainInvoker(loader), System.err);
        if (status != 0) System.exit(status);
    }

    static int run(
        String[] arguments,
        InputStream credentialInput,
        Map<String, String> environment,
        EntrypointInvoker invoker,
        PrintStream errors
    ) {
        CredentialPayload credentials = null;
        String[] gameArguments = null;
        try {
            LaunchProfile profile = LaunchProfile.parse(arguments, environment);
            credentials = CredentialPayloadReader.readAndClose(credentialInput);
            gameArguments = GameArguments.create(profile, credentials);
            invoker.invoke(FABRIC_MAIN_CLASS, gameArguments);
            return 0;
        } catch (BootstrapFailure failure) {
            emitSafeError(errors, failure.kind().name(), failure.getMessage());
            return failure.exitStatus();
        } catch (RuntimeException | LinkageError failure) {
            // A dependency may include arbitrary argument values in its exception.
            // Report only this fixed diagnostic and deliberately discard its message.
            emitSafeError(errors, "BOOTSTRAP_INTERNAL", "The Family client bootstrap terminated unexpectedly.");
            return 70;
        } finally {
            if (gameArguments != null) Arrays.fill(gameArguments, null);
            if (credentials != null) credentials.close();
            if (credentialInput != null) {
                try { credentialInput.close(); } catch (Exception ignored) { /* Best-effort close. */ }
            }
        }
    }

    private static void emitSafeError(PrintStream errors, String code, String message) {
        if (errors == null) return;
        errors.println("Mastermind Family Client bootstrap failed [" + code + "]: " + message);
    }
}
