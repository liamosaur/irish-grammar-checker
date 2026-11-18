#!/bin/bash
# Runs the original Perl engine (a built Lingua-GA-Gramadoir-0.70 dist) in WSL with the REAL String::Approx,
# which is what produces spelling suggestions (--aspell). The msys Perl used for the other parity tests only has
# a stub String::Approx (the module is C code), so suggestions can only be checked this way.
#
# One-off setup in WSL Ubuntu, no root needed:
#   mkdir -p ~/perl-approx && cd ~/perl-approx && apt-get download libstring-approx-perl && dpkg -x libstring-approx-perl_*.deb root
#
# usage (from Git Bash, MSYS_NO_PATHCONV=1 so /mnt/c paths survive):
#   export GRAMADOIR_DIST=/mnt/c/path/to/Lingua-GA-Gramadoir-0.70 WSLENV=GRAMADOIR_DIST/u
#   wsl.exe -d Ubuntu -- bash tools/perl-wsl.sh --api /mnt/c/path/to/words.txt --aspell > perl-out.xml
# <mode> is --api or --xml; further arguments go to scripts/gram-ga.pl.
DIST="${GRAMADOIR_DIST:?set GRAMADOIR_DIST to the Lingua-GA-Gramadoir-0.70 dist (a /mnt/... path)}"
export PERL5LIB="$HOME/perl-approx/root/usr/lib/x86_64-linux-gnu/perl5/5.38:$HOME/perl-approx/root/usr/share/perl5"
mode="$1"; file="$2"; shift 2
cd "$DIST" && perl -Ilib scripts/gram-ga.pl --incode=utf-8 --outcode=utf-8 --interface=en "$mode" "$@" "$file"
