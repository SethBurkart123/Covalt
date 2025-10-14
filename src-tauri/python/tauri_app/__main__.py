import sys
from multiprocessing import freeze_support
from tauri_app import main

freeze_support()
print("Hello, world!!!")
sys.exit(main())
