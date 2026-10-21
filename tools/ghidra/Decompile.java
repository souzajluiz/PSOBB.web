// Ghidra headless script: decompile the functions that contain the given
// addresses and print their C to stdout, between "=== <entry> <name>" markers.
// Run through tools/ghidra/decomp.sh, not directly.
//@category PSOBB
import ghidra.app.decompiler.DecompInterface;
import ghidra.app.decompiler.DecompileResults;
import ghidra.app.script.GhidraScript;
import ghidra.program.model.address.Address;
import ghidra.program.model.listing.Function;

public class Decompile extends GhidraScript {
  @Override
  public void run() throws Exception {
    DecompInterface ifc = new DecompInterface();
    ifc.openProgram(currentProgram);
    for (String arg : getScriptArgs()) {
      Address addr = toAddr(arg);
      Function fn = getFunctionContaining(addr);
      if (fn == null) {
        System.out.println("=== " + arg + " NO FUNCTION");
        continue;
      }
      DecompileResults res = ifc.decompileFunction(fn, 120, monitor);
      System.out.println("=== " + fn.getEntryPoint() + " " + fn.getName() + " (asked " + arg + ")");
      if (res.decompileCompleted()) {
        System.out.println(res.getDecompiledFunction().getC());
      } else {
        System.out.println("decompile failed: " + res.getErrorMessage());
      }
    }
    ifc.dispose();
  }
}
