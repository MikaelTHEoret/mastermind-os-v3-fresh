package com.mastermind.minecraft.familyclientbootstrap;

import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;

final class ReflectiveMainInvoker implements EntrypointInvoker {
    private final ClassLoader classLoader;

    ReflectiveMainInvoker(ClassLoader classLoader) {
        this.classLoader = classLoader;
    }

    @Override
    public void invoke(String className, String[] arguments) throws BootstrapFailure {
        final Class<?> entrypoint;
        final Method main;
        try {
            entrypoint = Class.forName(className, true, classLoader);
            main = entrypoint.getMethod("main", String[].class);
        } catch (ClassNotFoundException | NoSuchMethodException | LinkageError error) {
            throw new BootstrapFailure(
                BootstrapFailure.Kind.FABRIC_ENTRYPOINT_UNAVAILABLE,
                "The verified Fabric KnotClient entrypoint is unavailable."
            );
        }
        if (!Modifier.isPublic(main.getModifiers()) || !Modifier.isStatic(main.getModifiers()) || main.getReturnType() != void.class) {
            throw new BootstrapFailure(
                BootstrapFailure.Kind.FABRIC_ENTRYPOINT_UNAVAILABLE,
                "The verified Fabric KnotClient entrypoint has an invalid signature."
            );
        }
        try {
            main.invoke(null, (Object) arguments);
        } catch (IllegalAccessException | IllegalArgumentException error) {
            throw new BootstrapFailure(
                BootstrapFailure.Kind.FABRIC_ENTRYPOINT_UNAVAILABLE,
                "The verified Fabric KnotClient entrypoint could not be invoked."
            );
        } catch (InvocationTargetException | ExceptionInInitializerError error) {
            // Do not propagate or format the target exception: third-party messages
            // must never be allowed to echo an argument containing the access token.
            throw new BootstrapFailure(
                BootstrapFailure.Kind.FABRIC_ENTRYPOINT_FAILED,
                "Fabric KnotClient terminated with an error."
            );
        }
    }
}

