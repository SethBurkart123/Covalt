import sys
from multiprocessing import freeze_support
from tauri_app import main

freeze_support()
sys.exit(main())
