"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useWebSocket } from "@/contexts/websocket-context";
import { useState, useEffect } from "react";

export function SplashScreen() {
  const { isConnected } = useWebSocket();
  const [show, setShow] = useState(true);

  useEffect(() => {
    if (isConnected) setShow(false);
  }, [isConnected]);

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-background"
          initial={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
        >
          <motion.div
            className="flex flex-col items-center gap-6"
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: "easeOut" }}
          >
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              Covalt
            </h1>
            <div className="flex items-center gap-1.5">
              {[0, 1, 2].map((i) => (
                <motion.div
                  key={i}
                  className="size-1.5 rounded-full bg-muted-foreground/50"
                  animate={{ opacity: [0.3, 1, 0.3] }}
                  transition={{
                    duration: 1.2,
                    repeat: Infinity,
                    delay: i * 0.2,
                    ease: "easeInOut",
                  }}
                />
              ))}
            </div>
            <p className="text-sm text-muted-foreground">
              Connecting to backend...
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
