import os
import sys

HERE = os.path.dirname(__file__)
sys.path[:0] = [os.path.abspath(os.path.join(HERE, "..")), HERE]
