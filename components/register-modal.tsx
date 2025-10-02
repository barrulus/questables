import { useState } from "react";
import type { CheckedState } from "@radix-ui/react-checkbox";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "./ui/dialog";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "./ui/select";
import { Separator } from "./ui/separator";
import { Checkbox } from "./ui/checkbox";
import { toast } from "sonner";
import { Eye, EyeOff, Mail, Lock, User, Crown, Shield } from "lucide-react";
import { register as registerUser } from "../utils/api/auth";
import { useUser } from "../contexts/UserContext";

interface RegisterModalProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onRegister: () => void;
  onSwitchToLogin: () => void;
}

export function RegisterModal(props: RegisterModalProps) {
  const { onOpenChange, onRegister, onSwitchToLogin } = props;
  const [formData, setFormData] = useState({
    username: "",
    email: "",
    password: "",
    confirmPassword: "",
    role: "player" as "player" | "dm" | "admin"
  });
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [acceptTerms, setAcceptTerms] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const { login } = useUser();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // Validation
    if (!formData.username.trim()) {
      toast.error("Please enter a username");
      setIsLoading(false);
      return;
    }

    if (formData.password !== formData.confirmPassword) {
      toast.error("Passwords do not match");
      setIsLoading(false);
      return;
    }

    if (formData.password.length < 6) {
      toast.error("Password must be at least 6 characters");
      setIsLoading(false);
      return;
    }

    if (!acceptTerms) {
      toast.error("Please accept the terms and conditions");
      setIsLoading(false);
      return;
    }

    try {
      await registerUser({
        username: formData.username.trim(),
        email: formData.email.trim(),
        password: formData.password,
        roles: [formData.role],
      });

      let authenticatedUser;
      try {
        authenticatedUser = await login(formData.email, formData.password);
      } catch (authError) {
        const message = authError instanceof Error ? authError.message : "Unable to sign in after registration.";
        toast.error(message);
        return;
      }

      onRegister();
      toast.success(`Welcome ${authenticatedUser.username}! Your account has been created.`);
      onOpenChange(false);
    } catch (dbError) {
      const errorMessage = dbError instanceof Error ? dbError.message : "Registration failed. Please try again.";
      console.error('Registration failed:', dbError);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  const getRoleDescription = (role: string) => {
    switch (role) {
      case "player": return "Join campaigns and manage your characters";
      case "dm": return "Create and manage campaigns, NPCs, and adventures";
      case "admin": return "Full system access and user management";
      default: return "";
    }
  };

  return (
    <Dialog open={props.open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px] p-0 max-h-[90vh] overflow-y-auto">
        <DialogHeader className="p-6 pb-2">
          <DialogTitle className="text-2xl">Create Your Account</DialogTitle>
          <DialogDescription>
            Join thousands of adventurers and start your D&D journey
          </DialogDescription>
        </DialogHeader>

        <div className="px-6 pb-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="username">Username *</Label>
              <div className="relative">
                <User className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  id="username"
                  type="text"
                  value={formData.username}
                  onChange={(e) => setFormData(prev => ({ ...prev, username: e.target.value }))}
                  placeholder="Choose a username"
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="email">Email *</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  id="email"
                  type="email"
                  value={formData.email}
                  onChange={(e) => setFormData(prev => ({ ...prev, email: e.target.value }))}
                  placeholder="Enter your email"
                  className="pl-10"
                  required
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="role">Account Type *</Label>
              <Select 
                value={formData.role} 
                onValueChange={(value) => setFormData(prev => ({ ...prev, role: value as "player" | "dm" | "admin" }))}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="player">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4" />
                      <div>
                        <div className="font-medium">Player</div>
                        <div className="text-xs text-muted-foreground">Join campaigns and manage characters</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="dm">
                    <div className="flex items-center gap-2">
                      <Shield className="w-4 h-4" />
                      <div>
                        <div className="font-medium">Dungeon Master</div>
                        <div className="text-xs text-muted-foreground">Create and manage campaigns</div>
                      </div>
                    </div>
                  </SelectItem>
                  <SelectItem value="admin">
                    <div className="flex items-center gap-2">
                      <Crown className="w-4 h-4" />
                      <div>
                        <div className="font-medium">Administrator</div>
                        <div className="text-xs text-muted-foreground">Full system access</div>
                      </div>
                    </div>
                  </SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {getRoleDescription(formData.role)}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Password *</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  id="password"
                  type={showPassword ? "text" : "password"}
                  value={formData.password}
                  onChange={(e) => setFormData(prev => ({ ...prev, password: e.target.value }))}
                  placeholder="Choose a password"
                  className="pl-10 pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowPassword(!showPassword)}
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Password must be at least 6 characters long
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Confirm Password *</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground w-4 h-4" />
                <Input
                  id="confirmPassword"
                  type={showConfirmPassword ? "text" : "password"}
                  value={formData.confirmPassword}
                  onChange={(e) => setFormData(prev => ({ ...prev, confirmPassword: e.target.value }))}
                  placeholder="Confirm your password"
                  className="pl-10 pr-10"
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-0 top-0 h-full px-3"
                  onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                >
                  {showConfirmPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </Button>
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox 
                id="terms" 
                checked={acceptTerms}
                onCheckedChange={(checked: CheckedState) => setAcceptTerms(checked === true)}
              />
              <Label 
                htmlFor="terms" 
                className="text-sm text-muted-foreground cursor-pointer"
              >
                I agree to the{" "}
                <a href="#" className="text-primary hover:underline">
                  Terms of Service
                </a>{" "}
                and{" "}
                <a href="#" className="text-primary hover:underline">
                  Privacy Policy
                </a>
              </Label>
            </div>

            <Button type="submit" className="w-full" disabled={isLoading}>
              {isLoading ? "Creating Account..." : "Create Account"}
            </Button>
          </form>

          <Separator className="my-6" />

          <div className="text-center">
            <span className="text-sm text-muted-foreground">Already have an account? </span>
            <Button
              variant="link"
              className="p-0 h-auto text-sm"
              onClick={onSwitchToLogin}
            >
              Sign in
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
