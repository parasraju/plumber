from setuptools import setup, find_packages

setup(
    name="plumber-linter",
    version="0.2.0",
    description="Deterministic Code Leak, Clog, and AI Slop Inspector",
    author="Plumber Authors",
    packages=find_packages(),
    python_requires=">=3.10",
    entry_points={
        "console_scripts": [
            "plumber = plumber.cli:main",
        ],
    },
)
